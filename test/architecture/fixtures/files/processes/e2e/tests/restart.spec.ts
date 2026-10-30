import { execSync, spawn } from "node:child_process"

const child = spawn("mix", ["phx.server"])
child.kill("SIGTERM")
process.kill(child.pid ?? 0)
execSync("pkill -f phx.server")
