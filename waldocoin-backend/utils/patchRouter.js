// utils/patchRouter.js
export const patchRouter = (router, file) => {
  const methods = ["get", "post", "use"];
  for (const method of methods) {
    const original = router[method];
    router[method] = function (path, ...handlers) {
      if (typeof path === "string" && /:[^\/]+:/.test(path)) {
        console.warn(`⚠️ Possibly malformed route in ${file}: ${method.toUpperCase()} ${path}`);
        path = path.replace(/:([^\/]+):/g, ":$1"); // Sanitize accidental double colons
      }
      return original.call(this, path, ...handlers);
    };
  }
};
