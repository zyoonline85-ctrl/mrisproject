class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function badRequest(message, details) {
  return new HttpError(400, message, details);
}

function unauthorized(message = "Token tidak valid atau belum login.") {
  return new HttpError(401, message);
}

function forbidden(message = "Akses tidak tersedia untuk role ini.") {
  return new HttpError(403, message);
}

function notFound(message = "Data tidak ditemukan.") {
  return new HttpError(404, message);
}

function validationError(details) {
  return new HttpError(422, "Validasi data gagal.", details);
}

module.exports = {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  validationError
};
