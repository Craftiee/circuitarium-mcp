param(
    [Parameter(Mandatory = $true)]
    [string]$FramesDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "The GIF renderer uses Windows Presentation Foundation. Run it on Windows."
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $repositoryRoot "docs\assets"
$outputPath = Join-Path $outputDirectory "circuitarium-inspector-demo.gif"
$resolvedFramesDirectory = (Resolve-Path -LiteralPath $FramesDirectory).Path
$frameNames = @(
    "01-connected.png",
    "02-tools.png",
    "03-capabilities.png",
    "04-crumb-erc.png",
    "05-logisim-vector.png"
)
$delays = [UInt16[]]@(220, 220, 320, 320, 500)

Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$encoder = [Windows.Media.Imaging.GifBitmapEncoder]::new()
$expectedWidth = $null
$expectedHeight = $null
for ($index = 0; $index -lt $frameNames.Count; $index++) {
    $framePath = Join-Path $resolvedFramesDirectory $frameNames[$index]
    if (-not (Test-Path -LiteralPath $framePath -PathType Leaf)) {
        throw "Missing Inspector demo frame: $($frameNames[$index])"
    }
    $stream = [IO.File]::OpenRead($framePath)
    try {
        $decoder = [Windows.Media.Imaging.BitmapDecoder]::Create(
            $stream,
            [Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat,
            [Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        )
        $source = $decoder.Frames[0]
    }
    finally {
        $stream.Dispose()
    }
    if ($null -eq $expectedWidth) {
        $expectedWidth = $source.PixelWidth
        $expectedHeight = $source.PixelHeight
    }
    elseif (
        $source.PixelWidth -ne $expectedWidth -or
        $source.PixelHeight -ne $expectedHeight
    ) {
        throw "Inspector demo frames must have identical dimensions."
    }
    $metadata = [Windows.Media.Imaging.BitmapMetadata]::new("gif")
    $metadata.SetQuery("/grctlext/Delay", $delays[$index])
    $encoder.Frames.Add(
        [Windows.Media.Imaging.BitmapFrame]::Create(
            $source,
            $source.Thumbnail,
            $metadata,
            $source.ColorContexts
        )
    )
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$outputStream = [IO.File]::Open(
    $outputPath,
    [IO.FileMode]::Create,
    [IO.FileAccess]::Write,
    [IO.FileShare]::None
)
try {
    $encoder.Save($outputStream)
}
finally {
    $outputStream.Dispose()
}

# WPF can omit graphic-control extensions for decoded screenshots. Rebuild the
# block stream with one delay extension per image plus infinite browser looping.
$gifBytes = [IO.File]::ReadAllBytes($outputPath)
$packedFields = $gifBytes[10]
$globalColorTableBytes = 0
if (($packedFields -band 0x80) -ne 0) {
    $globalColorCount = 1 -shl (($packedFields -band 0x07) + 1)
    $globalColorTableBytes = 3 * $globalColorCount
}
$blockOffset = 13 + $globalColorTableBytes
$loopExtension = [byte[]]@(
    0x21, 0xFF, 0x0B,
    0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30,
    0x03, 0x01, 0x00, 0x00, 0x00
)
$rewritten = [IO.MemoryStream]::new()
try {
    $rewritten.Write($gifBytes, 0, $blockOffset)
    $rewritten.Write($loopExtension, 0, $loopExtension.Length)
    $cursor = $blockOffset
    $frameIndex = 0
    $pendingGraphicControl = $false
    while ($cursor -lt $gifBytes.Length) {
        $blockStart = $cursor
        $marker = $gifBytes[$cursor]
        if ($marker -eq 0x3B) {
            $rewritten.WriteByte($marker)
            $cursor++
            break
        }
        if ($marker -eq 0x21) {
            if ($cursor + 2 -ge $gifBytes.Length) {
                throw "Truncated GIF extension."
            }
            $label = $gifBytes[$cursor + 1]
            $cursor += 2
            while ($true) {
                if ($cursor -ge $gifBytes.Length) {
                    throw "Truncated GIF extension sub-block."
                }
                $blockLength = [int]$gifBytes[$cursor]
                $cursor++
                if ($blockLength -eq 0) {
                    break
                }
                $cursor += $blockLength
                if ($cursor -gt $gifBytes.Length) {
                    throw "Truncated GIF extension payload."
                }
            }
            $extensionLength = $cursor - $blockStart
            $extension = New-Object byte[] $extensionLength
            [Array]::Copy(
                $gifBytes,
                $blockStart,
                $extension,
                0,
                $extensionLength
            )
            if ($label -eq 0xF9) {
                if ($frameIndex -ge $delays.Count -or $extensionLength -ne 8) {
                    throw "Unexpected GIF graphic-control extension."
                }
                $delay = $delays[$frameIndex]
                $extension[4] = [byte]($delay -band 0xFF)
                $extension[5] = [byte](($delay -shr 8) -band 0xFF)
                $pendingGraphicControl = $true
            }
            $rewritten.Write($extension, 0, $extension.Length)
            continue
        }
        if ($marker -ne 0x2C) {
            throw "Unexpected GIF block marker 0x$($marker.ToString('X2'))."
        }
        if ($frameIndex -ge $delays.Count) {
            throw "GIF contains more frames than the Inspector demo."
        }
        if (-not $pendingGraphicControl) {
            $delay = $delays[$frameIndex]
            $graphicControl = [byte[]]@(
                0x21, 0xF9, 0x04, 0x00,
                [byte]($delay -band 0xFF),
                [byte](($delay -shr 8) -band 0xFF),
                0x00, 0x00
            )
            $rewritten.Write($graphicControl, 0, $graphicControl.Length)
        }
        $cursor += 10
        if ($cursor -gt $gifBytes.Length) {
            throw "Truncated GIF image descriptor."
        }
        $imagePackedFields = $gifBytes[$blockStart + 9]
        if (($imagePackedFields -band 0x80) -ne 0) {
            $localColorCount = 1 -shl (($imagePackedFields -band 0x07) + 1)
            $cursor += 3 * $localColorCount
        }
        $cursor++ # LZW minimum code size.
        while ($true) {
            if ($cursor -ge $gifBytes.Length) {
                throw "Truncated GIF image data."
            }
            $blockLength = [int]$gifBytes[$cursor]
            $cursor++
            if ($blockLength -eq 0) {
                break
            }
            $cursor += $blockLength
            if ($cursor -gt $gifBytes.Length) {
                throw "Truncated GIF image payload."
            }
        }
        $imageLength = $cursor - $blockStart
        $rewritten.Write($gifBytes, $blockStart, $imageLength)
        $frameIndex++
        $pendingGraphicControl = $false
    }
    if ($frameIndex -ne $frameNames.Count -or $cursor -ne $gifBytes.Length) {
        throw "Expected $($frameNames.Count) complete GIF frames."
    }
    [IO.File]::WriteAllBytes($outputPath, $rewritten.ToArray())
}
finally {
    $rewritten.Dispose()
}

$file = Get-Item -LiteralPath $outputPath
Write-Output "Generated $($file.FullName) ($($file.Length) bytes) from $($frameNames.Count) Inspector frames."
