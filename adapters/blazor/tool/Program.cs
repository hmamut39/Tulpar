// A Blazor design system's components, read from its compiled assemblies without running them
// (MetadataLoadContext only inspects metadata): every public component, with its [Parameter] properties.
// usage: IndexComponents <project.assets.json> <package> [<package>…]   →  JSON on stdout

using System.Reflection;
using System.Text.Json;

var assets = JsonDocument.Parse(File.ReadAllText(args[0])).RootElement;
var wanted = new HashSet<string>(args.Skip(1), StringComparer.OrdinalIgnoreCase);
var folders = assets.GetProperty("packageFolders").EnumerateObject().Select(f => f.Name).ToList();
var libraries = assets.GetProperty("libraries");
var dlls = new List<string>();
var designSystem = new List<string>();
foreach (var target in assets.GetProperty("targets").EnumerateObject())
{
    foreach (var lib in target.Value.EnumerateObject())
    {
        if (!lib.Value.TryGetProperty("compile", out var compile)) continue;
        var dir = libraries.GetProperty(lib.Name).GetProperty("path").GetString()!;
        foreach (var file in compile.EnumerateObject().Where(f => f.Name.EndsWith(".dll")))
        {
            var path = folders.Select(f => Path.Combine(f, dir, file.Name)).FirstOrDefault(File.Exists);
            if (path is null) continue;
            dlls.Add(path);
            if (wanted.Contains(lib.Name.Split('/')[0])) designSystem.Add(path);
        }
    }
    break;
}
dlls.AddRange(Directory.GetFiles(Path.GetDirectoryName(typeof(object).Assembly.Location)!, "*.dll"));

using var context = new MetadataLoadContext(new PathAssemblyResolver(dlls.DistinctBy(Path.GetFileName)));
var components = new List<object>();
foreach (var path in designSystem)
{
    foreach (var type in context.LoadFromAssemblyPath(path).GetExportedTypes())
    {
        if (type.IsAbstract || !type.IsClass || !IsComponent(type)) continue;
        var parameters = type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(p => p.CustomAttributes.Any(a => a.AttributeType.Name == "ParameterAttribute"))
            .GroupBy(p => p.Name).Select(g => g.First())
            .Select(Describe).ToList();
        components.Add(new
        {
            name = type.Name.Split('`')[0],
            ns = type.Namespace,
            typeParams = type.IsGenericTypeDefinition ? type.GetGenericArguments().Select(a => a.Name).ToArray() : Array.Empty<string>(),
            parameters,
        });
    }
}
Console.WriteLine(JsonSerializer.Serialize(new { components }));

static bool IsComponent(Type? t)
{
    for (; t is not null; t = t.BaseType) if (t.FullName == "Microsoft.AspNetCore.Components.ComponentBase") return true;
    return false;
}

static object Describe(PropertyInfo p)
{
    var type = p.PropertyType;
    if (type.IsGenericType && type.GetGenericTypeDefinition().FullName == "System.Nullable`1") type = type.GetGenericArguments()[0];
    return new
    {
        name = p.Name,
        type = Name(type),
        required = p.CustomAttributes.Any(a => a.AttributeType.Name == "EditorRequiredAttribute"),
        values = type.IsEnum ? type.GetFields(BindingFlags.Public | BindingFlags.Static).Select(f => f.Name).ToArray() : null,
        deprecated = p.CustomAttributes.Any(a => a.AttributeType.Name == "ObsoleteAttribute"),
        attributes = p.CustomAttributes.Any(a => a.AttributeType.Name == "ParameterAttribute" && a.NamedArguments.Any(n => n.MemberName == "CaptureUnmatchedValues")),
    };
}

static string Name(Type t) => t.IsGenericType ? $"{t.Name.Split('`')[0]}<{string.Join(", ", t.GetGenericArguments().Select(Name))}>" : t.Name;
