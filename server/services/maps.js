function directionsUrl(from, to) {
  const origin = encodeURIComponent(from);
  const dest = encodeURIComponent(to);
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}`;
}

function addressUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function postcodeUrl(postcode) {
  return addressUrl(postcode);
}

function formatMoveRoute(job) {
  const from = [job.from_line1, job.from_city, job.from_postcode].filter(Boolean).join(', ');
  const to = [job.to_line1, job.to_city, job.to_postcode].filter(Boolean).join(', ');
  return {
    from,
    to,
    fromUrl: from ? addressUrl(from) : null,
    toUrl: to ? addressUrl(to) : null,
    directionsUrl: from && to ? directionsUrl(from, to) : null,
  };
}

module.exports = { directionsUrl, addressUrl, postcodeUrl, formatMoveRoute };
