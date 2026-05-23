{
  domain = "home.behaghel.org";
  exposure = "public";
  hostPort = 8101;
  containerPort = 8080;
  healthPath = "/health";
  metrics = {
    enable = true;
    path = "/metrics";
  };
}
