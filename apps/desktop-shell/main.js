const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

let coreProcess = null;
let mainWindow = null;

function waitForHealth(url, timeoutMs = 20000) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    function probe() {
      const req = http.get(url, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          resolve();
          return;
        }
        res.resume();
        retry();
      });

      req.on("error", retry);
    }

    function retry() {
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Timed out waiting for core-service health endpoint."));
        return;
      }
      setTimeout(probe, 500);
    }

    probe();
  });
}

function startCoreService() {
  const coreEntry = path.resolve(__dirname, "..", "core-service", "src", "index.js");
  coreProcess = spawn(process.execPath, [coreEntry], {
    cwd: path.resolve(__dirname, "..", ".."),
    env: { ...process.env, LAIVE_API_PORT: process.env.LAIVE_API_PORT || "4800" },
    stdio: "inherit"
  });

  coreProcess.on("exit", (code) => {
    console.log(`[desktop] core-service exited with code ${code}`);
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#090b12",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const targetUrl = `http://127.0.0.1:${process.env.LAIVE_API_PORT || 4800}`;
  await waitForHealth(`${targetUrl}/health`);
  await mainWindow.loadURL(targetUrl);
}

app.whenReady().then(async () => {
  startCoreService();
  await createWindow();
});

app.on("window-all-closed", () => {
  if (coreProcess) {
    coreProcess.kill("SIGTERM");
    coreProcess = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
