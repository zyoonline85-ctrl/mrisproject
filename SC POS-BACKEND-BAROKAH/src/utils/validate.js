const { validationError } = require("./http-error");

function validate(schema, source = "body") {
  return function validateRequest(req, res, next) {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(validationError(result.error.flatten()));
    }
    req[source] = result.data;
    return next();
  };
}

module.exports = validate;
