{
  exposure = "public";
  hostPort = 8103;
  containerPort = 8080;
  healthPath = "/health";
  metrics = {
    enable = true;
    path = "/metrics";
  };
}
