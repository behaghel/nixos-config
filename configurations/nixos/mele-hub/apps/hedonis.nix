{
  exposure = "public";
  hostPort = 8102;
  containerPort = 8080;
  healthPath = "/health";
  metrics = {
    enable = true;
    path = "/metrics";
  };
}
