using System;
using Orbit.Tools.Services;

namespace Orbit.Tools
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var greeter = new Greeter();
            Console.WriteLine(greeter.Greet("Orbit"));
        }
    }
}
