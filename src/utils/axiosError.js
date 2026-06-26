function classifyAxiosError(err) {
  const error = new Error();
  error.requestId = undefined;

  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    error.status = 502;
    error.code = 'ERR_BAD_GATEWAY';
    error.message = 'Upstream service unavailable';
    return error;
  }

  if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
    error.status = 504;
    error.code = 'ERR_TIMEOUT';
    error.message = 'Upstream service timeout';
    return error;
  }

  if (err.response) {
    error.status = err.response.status;
    error.message = err.response.data?.error || err.response.statusText || 'Upstream service error';
    if (error.status >= 500) {
      error.code = 'ERR_BAD_GATEWAY';
    } else if (error.status === 404) {
      error.code = 'ERR_NOT_FOUND';
    } else if (error.status === 403) {
      error.code = 'ERR_FORBIDDEN';
    } else {
      error.code = 'ERR_VALIDATION';
    }
    return error;
  }

  error.status = 502;
  error.code = 'ERR_BAD_GATEWAY';
  error.message = err.message || 'Upstream service error';
  return error;
}

module.exports = { classifyAxiosError };
