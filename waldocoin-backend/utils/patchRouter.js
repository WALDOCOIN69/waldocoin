// utils/patchRouter.js
// No pathToRegexp call!

export function patchRouter(router, name = "unknown") {
  const originalGet = router.get.bind(router);
  const originalPost = router.post.bind(router);
  const originalDelete = router.delete.bind(router);
  const originalUse = router.use.bind(router);

  const validate = (method, path) => {
    if (typeof path !== "string") return;
    // Only warn on possibly broken patterns, DO NOT CALL pathToRegexp
    if (/\/:($|[^a-zA-Z0-9_])/.test(path)) {
      console.warn(`⚠️ POSSIBLY INVALID PARAM: ${method.toUpperCase()} ${path}`);
      return;
    }
  };

  router.get = (path, ...args) => {
    validate("get", path);
    return originalGet(path, ...args);
  };
  router.post = (path, ...args) => {
    validate("post", path);
    return originalPost(path, ...args);
  };
  router.delete = (path, ...args) => {
    validate("delete", path);
    return originalDelete(path, ...args);
  };
  router.use = (path, ...args) => {
    validate("use", path);
    return originalUse(path, ...args);
  };
}





