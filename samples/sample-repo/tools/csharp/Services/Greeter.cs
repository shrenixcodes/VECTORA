namespace Orbit.Tools.Services
{
    public interface IGreeter
    {
        string Greet(string name);
    }

    public class Greeter : IGreeter
    {
        public string Greet(string name)
        {
            return Format(name);
        }

        private string Format(string name)
        {
            return "Hello, " + name;
        }
    }
}
