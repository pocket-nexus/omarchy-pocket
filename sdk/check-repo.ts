// SPDX-License-Identifier: GPL-3.0-or-later
// bun sdk/check-repo.ts applets/<name>: pocket-applet check, from a computer.
import { resolve } from "node:path";
import { checkApplet, printFindings } from "./check.ts";

const findings = checkApplet(resolve(process.argv[2] ?? "."), resolve(import.meta.dir, "template"));
printFindings(findings);
process.exit(findings.some((finding) => finding.level === "error") ? 1 : 0);
