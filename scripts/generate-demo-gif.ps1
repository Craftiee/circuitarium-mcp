$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "The GIF renderer uses Windows Presentation Foundation. Run it on Windows."
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $repositoryRoot "docs\assets"
$outputPath = Join-Path $outputDirectory "circuitarium-terminal-demo.gif"
$fixturePath = "fixtures/crumb/breadboard-led.cru"
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

function Invoke-CircuitariumCliJson {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $output = & $npm run --silent cli -- @Arguments 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        throw "Circuitarium CLI failed: $output"
    }
    return $output | ConvertFrom-Json
}

Push-Location $repositoryRoot
try {
    $erc = Invoke-CircuitariumCliJson -Arguments @("check", $fixturePath)
    $bom = Invoke-CircuitariumCliJson -Arguments @("bom", $fixturePath)
    $netlist = Invoke-CircuitariumCliJson -Arguments @("netlist", $fixturePath, "50")
}
finally {
    Pop-Location
}

if (
    $erc.contractVersion -ne "electronics.mcp/0.2" -or
    $bom.contractVersion -ne "electronics.mcp/0.2" -or
    $netlist.contractVersion -ne "electronics.mcp/0.2"
) {
    throw "The demo commands did not return the expected MCP contract."
}
if (-not $erc.ok -or -not $bom.ok -or -not $netlist.ok) {
    throw "A demo command returned an unsuccessful tool envelope."
}

$ledLine = $bom.data.lines | Where-Object { $_.kind -eq "led-5mm" } | Select-Object -First 1
$boardLine = $bom.data.lines | Where-Object { $_.kind -eq "breadboard" } | Select-Object -First 1
if ($null -eq $ledLine -or $null -eq $boardLine) {
    throw "The synthetic LED fixture no longer has the expected BOM."
}

$lines = @(
    [pscustomobject]@{ Text = "PS> npm run cli -- check $fixturePath"; Color = "#7EE787" },
    [pscustomobject]@{ Text = "  $($erc.summary)"; Color = "#F0F6FC" },
    [pscustomobject]@{ Text = "  valid=$($erc.data.valid)  errors=$($erc.data.totals.errors)  warnings=$($erc.data.totals.warnings)"; Color = "#58A6FF" },
    [pscustomobject]@{ Text = "  profile: $($erc.context.compatibilityProfile)"; Color = "#8B949E" },
    [pscustomobject]@{ Text = ""; Color = "#C9D1D9" },
    [pscustomobject]@{ Text = "PS> npm run cli -- bom $fixturePath"; Color = "#7EE787" },
    [pscustomobject]@{ Text = "  $($bom.summary)"; Color = "#F0F6FC" },
    [pscustomobject]@{ Text = "  $($boardLine.quantity)x $($boardLine.label)"; Color = "#C9D1D9" },
    [pscustomobject]@{ Text = "  $($ledLine.quantity)x $($ledLine.label)  Vf=$($ledLine.identity.forwardVoltage.value)V  Imax=$([int]($ledLine.identity.maxCurrent.value * 1000))mA"; Color = "#C9D1D9" },
    [pscustomobject]@{ Text = ""; Color = "#C9D1D9" },
    [pscustomobject]@{ Text = "PS> npm run cli -- netlist $fixturePath"; Color = "#7EE787" },
    [pscustomobject]@{ Text = "  $($netlist.summary)"; Color = "#F0F6FC" },
    [pscustomobject]@{ Text = "  topology: $($netlist.data.topologyMode)"; Color = "#8B949E" },
    [pscustomobject]@{ Text = ""; Color = "#C9D1D9" },
    [pscustomobject]@{ Text = "  Synthetic fixture only - no CRUMB imagery or third-party design."; Color = "#D29922" }
)

Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$width = 1040
$height = 560
$dpi = 96
$fontSize = 15
$lineHeight = 27
$textLeft = 38
$textTop = 88
$typeface = [Windows.Media.Typeface]::new("Consolas")
$background = [Windows.Media.Brushes]::Black
$terminalBackground = [Windows.Media.SolidColorBrush]::new(
    [Windows.Media.ColorConverter]::ConvertFromString("#0D1117")
)
$titleBackground = [Windows.Media.SolidColorBrush]::new(
    [Windows.Media.ColorConverter]::ConvertFromString("#161B22")
)
$borderPen = [Windows.Media.Pen]::new(
    [Windows.Media.SolidColorBrush]::new(
        [Windows.Media.ColorConverter]::ConvertFromString("#30363D")
    ),
    1
)
$encoder = [Windows.Media.Imaging.GifBitmapEncoder]::new()

function New-DemoFrame {
    param(
        [Parameter(Mandatory = $true)]
        [int]$VisibleLines,
        [Parameter(Mandatory = $true)]
        [UInt16]$Delay
    )

    $visual = [Windows.Media.DrawingVisual]::new()
    $drawing = $visual.RenderOpen()
    try {
        $drawing.DrawRectangle(
            $background,
            $null,
            [Windows.Rect]::new(0, 0, $width, $height)
        )
        $drawing.DrawRoundedRectangle(
            $terminalBackground,
            $borderPen,
            [Windows.Rect]::new(12, 12, $width - 24, $height - 24),
            12,
            12
        )
        $drawing.DrawRoundedRectangle(
            $titleBackground,
            $null,
            [Windows.Rect]::new(13, 13, $width - 26, 55),
            11,
            11
        )

        foreach ($dot in @(
            @{ X = 38; Color = "#FF5F56" },
            @{ X = 62; Color = "#FFBD2E" },
            @{ X = 86; Color = "#27C93F" }
        )) {
            $brush = [Windows.Media.SolidColorBrush]::new(
                [Windows.Media.ColorConverter]::ConvertFromString($dot.Color)
            )
            $drawing.DrawEllipse(
                $brush,
                $null,
                [Windows.Point]::new($dot.X, 40),
                7,
                7
            )
        }

        $title = [Windows.Media.FormattedText]::new(
            "Circuitarium MCP - real synthetic-fixture output",
            [Globalization.CultureInfo]::InvariantCulture,
            [Windows.FlowDirection]::LeftToRight,
            $typeface,
            15,
            [Windows.Media.SolidColorBrush]::new(
                [Windows.Media.ColorConverter]::ConvertFromString("#C9D1D9")
            ),
            1
        )
        $drawing.DrawText($title, [Windows.Point]::new(132, 29))

        for ($index = 0; $index -lt $VisibleLines; $index++) {
            $line = $lines[$index]
            $brush = [Windows.Media.SolidColorBrush]::new(
                [Windows.Media.ColorConverter]::ConvertFromString($line.Color)
            )
            $text = [Windows.Media.FormattedText]::new(
                [string]$line.Text,
                [Globalization.CultureInfo]::InvariantCulture,
                [Windows.FlowDirection]::LeftToRight,
                $typeface,
                $fontSize,
                $brush,
                1
            )
            $drawing.DrawText(
                $text,
                [Windows.Point]::new(
                    $textLeft,
                    $textTop + ($index * $lineHeight)
                )
            )
        }
    }
    finally {
        $drawing.Close()
    }

    $bitmap = [Windows.Media.Imaging.RenderTargetBitmap]::new(
        $width,
        $height,
        $dpi,
        $dpi,
        [Windows.Media.PixelFormats]::Pbgra32
    )
    $bitmap.Render($visual)

    $metadata = [Windows.Media.Imaging.BitmapMetadata]::new("gif")
    $metadata.SetQuery("/grctlext/Delay", $Delay)
    # WPF emits the multi-frame GIF without relying on shell-specific
    # ImageMagick/ffmpeg installs. Hosts may choose whether to loop it.
    return [Windows.Media.Imaging.BitmapFrame]::Create(
        $bitmap,
        $null,
        $metadata,
        $null
    )
}

$encoder.Frames.Add((New-DemoFrame -VisibleLines 1 -Delay 65))
for ($visible = 2; $visible -le $lines.Count; $visible++) {
    $delay = if ($visible -eq $lines.Count) { [UInt16]500 } else { [UInt16]42 }
    $encoder.Frames.Add(
        (New-DemoFrame -VisibleLines $visible -Delay $delay)
    )
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$stream = [IO.File]::Open(
    $outputPath,
    [IO.FileMode]::Create,
    [IO.FileAccess]::Write,
    [IO.FileShare]::None
)
try {
    $encoder.Save($stream)
}
finally {
    $stream.Dispose()
}

# WPF emits every frame but leaves its GIF89a delay fields at zero. Patch
# those standard graphic-control extensions and add the standard Netscape
# loop extension so browsers render the intended terminal cadence.
$gifBytes = [IO.File]::ReadAllBytes($outputPath)
$frameIndex = 0
for ($offset = 0; $offset -le $gifBytes.Length - 8; $offset++) {
    if (
        $gifBytes[$offset] -eq 0x21 -and
        $gifBytes[$offset + 1] -eq 0xF9 -and
        $gifBytes[$offset + 2] -eq 0x04
    ) {
        $delay = if ($frameIndex -eq 0) {
            [UInt16]65
        }
        elseif ($frameIndex -eq $encoder.Frames.Count - 1) {
            [UInt16]500
        }
        else {
            [UInt16]42
        }
        $gifBytes[$offset + 4] = [byte]($delay -band 0xFF)
        $gifBytes[$offset + 5] = [byte](($delay -shr 8) -band 0xFF)
        $frameIndex++
    }
}
if ($frameIndex -ne $encoder.Frames.Count) {
    throw "Expected $($encoder.Frames.Count) GIF frames but patched $frameIndex."
}

$signature = [Text.Encoding]::ASCII.GetString($gifBytes, 0, 6)
if ($signature -notin @("GIF87a", "GIF89a")) {
    throw "The renderer did not produce a GIF stream."
}
$packedFields = $gifBytes[10]
$globalColorTableBytes = 0
if (($packedFields -band 0x80) -ne 0) {
    $globalColorCount = 1 -shl (($packedFields -band 0x07) + 1)
    $globalColorTableBytes = 3 * $globalColorCount
}
$loopOffset = 13 + $globalColorTableBytes
$loopExtension = [byte[]]@(
    0x21, 0xFF, 0x0B,
    0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30,
    0x03, 0x01, 0x00, 0x00, 0x00
)
$loopingGif = New-Object byte[] ($gifBytes.Length + $loopExtension.Length)
[Array]::Copy($gifBytes, 0, $loopingGif, 0, $loopOffset)
[Array]::Copy(
    $loopExtension,
    0,
    $loopingGif,
    $loopOffset,
    $loopExtension.Length
)
[Array]::Copy(
    $gifBytes,
    $loopOffset,
    $loopingGif,
    $loopOffset + $loopExtension.Length,
    $gifBytes.Length - $loopOffset
)
[IO.File]::WriteAllBytes($outputPath, $loopingGif)

$file = Get-Item -LiteralPath $outputPath
Write-Output "Generated $($file.FullName) ($($file.Length) bytes) from live CLI envelopes."
