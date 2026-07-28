#!/usr/bin/env node

import { executeServerCommand, processCommandIo } from "./terminal.js";

const exitCode = await executeServerCommand(
  process.argv.slice(2),
  async () => {
    const server = await import("./server.js");
    await server.startStdioServer();
    return server.listRegisteredToolNames().length;
  },
  processCommandIo(),
  async () => {
    const server = await import("./server.js");
    return server.runServerDoctor();
  },
);

process.exitCode = exitCode;
