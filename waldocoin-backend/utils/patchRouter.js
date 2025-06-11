import { pathToRegexp } from "path-to-regexp";

/**
 * Wraps a router to validate all registered paths for syntax errors.
 */
export function patchRouter(router, name = "unknown") {
  const originalGet = router.get.bind(router);
  const originalPost = router.post.bind(router);
  const originalDelete = router.delete.bind(router);
  const originalUse = router.use.bind(router);

  const validate = (method, path) => {
    try {
      pathToRegexp(path); // Throws only on *true* syntax errors
    } catch (err) {
      console.error(`❌ Invalid route in ${name}: ${method.toUpperCase()} ${path}`);
      console.error(err.message);
      process.exit(1);
    }

    // Warn ONLY on truly sketchy params (like missing param name)
    if (/\/:($|[^a-zA-Z0-9_])/.test(path)) {
      console.warn(`⚠️ POSSIBLY INVALID PARAM: ${method.toUpperCase()} ${path}`);
    }
  };

  router.get = (path, ...args) => {
    if (typeof path === "string") validate("get", path);
    return originalGet(path, ...args);
  };
  router.post = (path, ...args) => {
    if (typeof path === "string") validate("post", path);
    return originalPost(path, ...args);
  };
  router.delete = (path, ...args) => {
    if (typeof path === "string") validate("delete", path);
    return originalDelete(path, ...args);
  };
  router.use = (path, ...args) => {
    if (typeof path === "string") validate("use", path);
    return originalUse(path, ...args);
  };
}




