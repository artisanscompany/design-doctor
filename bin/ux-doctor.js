#!/usr/bin/env node
// ux-doctor — pure Node. No Ruby. No system deps.
// This shim loads the compiled CLI from dist/cli.js so we don't ship ts-node.
"use strict";

require("../dist/cli.js").start(process.argv.slice(2));
