function fn() {
  // baseUrl: where the running backend listens (`just backend up`).
  var baseUrl = karate.properties['baseUrl'] || 'http://localhost:8080';
  return { baseUrl: baseUrl };
}
