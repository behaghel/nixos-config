
package scalabasic

/** Main application entry point. */
object Main {
  
  /** Return a greeting message.
   * 
   * @param name The name to greet. Defaults to "World".
   * @return A greeting message.
   */
  def greet(name: String = "World"): String = 
    s"Hello, $name!"

  /** Main entry point. */
  def main(args: Array[String]): Unit = {
    val message = greet()
    println(message)
  }
}
