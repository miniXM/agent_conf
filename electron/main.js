const path = require("path");
const { app, BrowserWindow, dialog, shell } = require("electron");

let mainWindow = null;
let appServer = null;
let serverModule = null;

app.setName("agent_conf");
process.env.AGENT_CONF_DATA_DIR = path.join(app.getPath("userData"), "data");

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0f172a",
    title: serverModule.APP_NAME,
    icon: path.join(__dirname, "..", "assets", "app-icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const allowedPrefix = new URL(url).origin;
    if (!targetUrl.startsWith(allowedPrefix)) {
      event.preventDefault();
      shell.openExternal(targetUrl);
    }
  });

  mainWindow.loadURL(url);
}

async function bootstrap() {
  serverModule = require("../server");
  appServer = await serverModule.start();
  createMainWindow(appServer.url);
}

if (singleInstanceLock) {
  app.on("second-instance", () => {
    focusMainWindow();
  });

  app.whenReady().then(async () => {
    try {
      await bootstrap();
    } catch (error) {
      dialog.showErrorBox("启动失败", error && error.message ? error.message : String(error));
      app.quit();
      return;
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0 && appServer && appServer.url) {
        createMainWindow(appServer.url);
        return;
      }
      focusMainWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (appServer && appServer.server && !appServer.server.listening) return;
  if (appServer && appServer.server) {
    appServer.server.close();
  }
});
