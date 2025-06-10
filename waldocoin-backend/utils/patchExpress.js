// utils/patchExpress.js
import express from "express";

const originalRouter = express.Router;

express.Router = function (...args) {
  const router = originalRouter(...args);
  const methods = ["get", "post", "use"];

  for (const method of methods) {
    const original = router[method];
    router[method] = function (path, ...handlers) {
      if (typeof path === "string" && path.includes(":")) {
        console.warn(`⚠️ Suspicious route detected: ${method.toUpperCase()} ${path}`);
      }
      return original.call(this, path, ...handlers);
    };
  }

  return router;
};
