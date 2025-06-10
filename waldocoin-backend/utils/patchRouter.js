// utils/patchRouter.js
export const patchRouter = (router, file = 'unknown') => {
  const methods = ['get', 'post', 'use'];
  for (const method of methods) {
    const original = router[method];
    router[method] = function (path, ...handlers) {
      if (typeof path === 'string') {
        // Detect malformed parameter like :param: or empty colon pair :/
        const badSyntax = /:[^\/\s]+:|:\/|^:$/;
        if (badSyntax.test(path)) {
          console.error(`❌ BAD ROUTE DETECTED in ${file}: ${method.toUpperCase()} ${path}`);
          throw new Error(`❌ Invalid route pattern in ${file}: ${path}`);
        }
      }
      return original.call(this, path, ...handlers);
    };
  }
};




