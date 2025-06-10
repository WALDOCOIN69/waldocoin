export const patchRouter = (router, file = 'unknown') => {
  const methods = ['get', 'post', 'put', 'delete', 'use', 'patch', 'all'];

  for (const method of methods) {
    const original = router[method];
    router[method] = function (path, ...handlers) {
      if (typeof path === "string") {
        if (/:[^\/]+:/.test(path) || /:\/|:"/.test(path)) {
          console.error(`❌ BAD ROUTE DETECTED in ${file}: ${method.toUpperCase()} ${path}`);
          throw new Error(`❌ Invalid route pattern in ${file}: ${path}`);
        }
        if (/\/:($|\/)/.test(path)) {
          console.error(`❌ PATH ENDS WITH COLON — BAD SYNTAX in ${file}: ${method.toUpperCase()} ${path}`);
          throw new Error(`❌ Malformed route (dangling colon) in ${file}: ${path}`);
        }
      }
      return original.call(this, path, ...handlers);
    };
  }
};




