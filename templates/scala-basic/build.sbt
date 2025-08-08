
ThisBuild / version := "0.1.0"
ThisBuild / scalaVersion := "3.3.1"
ThisBuild / organization := "com.example"

lazy val root = (project in file("."))
  .settings(
    name := "scala-basic",
    
    // Dependencies
    libraryDependencies ++= Seq(
      "org.scalatest" %% "scalatest" % "3.2.17" % Test
    ),

    // Compiler options
    scalacOptions ++= Seq(
      "-deprecation",
      "-encoding", "utf8",
      "-feature",
      "-unchecked",
      "-Xfatal-warnings"
    ),

    // Assembly plugin settings for fat JAR creation
    assembly / mainClass := Some("scalabasic.Main"),
    assembly / assemblyJarName := "scala-basic.jar",

    // Test configuration
    Test / testOptions += Tests.Argument(TestFrameworks.ScalaTest, "-oD"),
    Test / parallelExecution := false
  )
