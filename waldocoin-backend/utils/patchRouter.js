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
      pathToRegexp(path); // ✅ Valid now
    } catch (err) {
      console.error(`❌ Invalid route in ${name}: ${method.toUpperCase()} ${path}`);
      console.error(err.message);
      process.exit(1);
    }

    if (path.includes("/:")) {
      console.warn(`⚠️ Suspicious route detected: ${method.toUpperCase()} ${path}`);
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






