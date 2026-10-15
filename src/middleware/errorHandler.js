export function notFound(req, res) {
  res.status(404).json({ error: `No existe la ruta ${req.method} ${req.originalUrl}.` });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "El cuerpo JSON de la solicitud no es válido." });
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "El cuerpo de la solicitud es demasiado grande." });
  }
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({ error: "Ya existe un registro con esos datos únicos." });
  }
  if (error.name === "SequelizeForeignKeyConstraintError") {
    return res.status(409).json({ error: "El registro está relacionado con otros datos y no se puede eliminar." });
  }
  if (error.name === "SequelizeValidationError") {
    return res.status(400).json({ error: "Los datos enviados no son válidos." });
  }

  console.error("Error interno del servidor:", error.name);
  return res.status(500).json({ error: "Error interno del servidor." });
}
