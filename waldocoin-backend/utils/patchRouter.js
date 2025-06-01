export const patchRouter = (router, file) => {
  const methods = ["get", "post", "use"];
  for (const method of methods) {
    const original = router[method];
    router[method] = function (path, ...handlers) {
      if (
        typeof path === "string" &&
        /:[^/]+:/.test(path) // catches "/:id:" or any malformed double-colon param
      ) {
        console.error(`❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${path} — SKIPPED`);
        return;
      }
      if (/\/:($|[^a-zA-Z_])/.test(path)) { // catches "/:" with no param name
        console.error(`❌ BAD ROUTE (MISSING PARAM NAME) in ${file}: ${method.toUpperCase()} ${path} — SKIPPED`);
        return;
      }
      return original.call(this, path, ...handlers);
    };
  }
};


