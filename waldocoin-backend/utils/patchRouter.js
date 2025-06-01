// utils/patchRouter.js
export const patchRouter = (router, file) => {
  const methods = ["get", "post", "use"];
  for (const method of methods) {
    const original = router[method];
    router[method] = function (path, ...handlers) {
      if (typeof path === "string") {
        // Catch malformed patterns like /path/:param: or /path/:
        if (/:[^/]+:/.test(path)) {
          console.error(`❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${path} — DOUBLE COLON`);
          return;
        }
        // Catch routes missing param name like "/:"
        if (/\/:($|[^a-zA-Z_])/.test(path)) {
          console.error(`❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${path} — MISSING PARAM NAME`);
          return;
        }
      }
      return original.call(this, path, ...handlers);
    };
  }
};


