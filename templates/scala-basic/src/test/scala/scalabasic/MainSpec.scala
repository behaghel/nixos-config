
package scalabasic

import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

class MainSpec extends AnyFlatSpec with Matchers {

  "greet" should "return default greeting" in {
    Main.greet() shouldEqual "Hello, World!"
  }

  it should "return greeting with custom name" in {
    Main.greet("Alice") shouldEqual "Hello, Alice!"
  }

  it should "handle empty name" in {
    Main.greet("") shouldEqual "Hello, !"
  }

  it should "handle special characters" in {
    Main.greet("Scala") shouldEqual "Hello, Scala!"
  }
}
