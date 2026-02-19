const { app } = require("electron"); console.log("app:", app); app.whenReady().then(() => { console.log("Ready\!"); app.quit(); });
