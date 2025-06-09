export const patchRouter = (router, file = 'unknown') => {
  const methods = ['get', 'post', 'use', 'put', 'delete', 'patch']

  for (const method of methods) {
    const original = router[method]
    router[method] = function (path, ...handlers) {
      if (typeof path === 'string') {
        // Detect double colon (e.g., /api/:user:/something)
        if (/:[^/]+:/.test(path)) {
          console.error(
            `❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${path} — DOUBLE COLON usage`
          )
          return
        }
        // Detect malformed param like '/:'
        if (/\/:($|[^a-zA-Z_])/.test(path)) {
          console.error(
            `❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${path} — MISSING PARAM NAME`
          )
          return
        }
      }

      return original.call(this, path, ...handlers)
    }
  }
}



