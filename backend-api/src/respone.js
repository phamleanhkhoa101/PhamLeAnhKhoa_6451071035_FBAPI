export function successResponse(res, data = null, message = "Success") {
  return res.json({
    success: true,
    message,
    data
  });
}

export function errorResponse(
  res,
  status = 500,
  code = "INTERNAL_ERROR",
  message = "Internal server error",
  details = null
) {
  return res.status(status).json({
    success: false,
    code,
    message,
    details
  });
}