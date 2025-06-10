// utils/wrapRouter.js
import express from "express";

export const wrapRouter = (file = "unknown") => {
  const router = express.Router();
  const methods = ["get", "post", "use"];

  for (const method of methods) {
    const original = router[method].bind(router);
    router[method] = (path, ...handlers) => {
      try {
        if (typeof path !== "string") {
          throw new Error(`❌ Non-string path registered in ${file}: ${JSON.stringify(path)}`);
        }
        if (/:[^\/]+:/.test(path) || /:(\/|$)/.test(path)) {
          throw new Error(`❌ Malformed route path in ${file}: ${path}`);
        }
        console.log(`✅ Registered ${method.toUpperCase()} ${path} in ${file}`);
        return original(path, ...handlers);
      } catch (err) {
        console.error(`❌ Route error in ${file}: ${err.message}`);
        throw err;
      }
    };
  }

  return router;
};

