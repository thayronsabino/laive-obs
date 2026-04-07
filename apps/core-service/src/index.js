const config = require("./config");
const { createRuntime } = require("./app-runtime");

async function main() {
  const runtime = createRuntime(config);
  await runtime.start();

  async function shutdown(signal) {
    runtime.services.logger.info("runtime.shutdown_requested", { signal });
    await runtime.stop();
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[core] fatal", error.message);
  process.exit(1);
});
