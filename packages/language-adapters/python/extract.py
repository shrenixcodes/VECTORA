"""VECTORA Python source analysis.

Reads a JSON list of {"path": <repository-relative>, "abs": <absolute>} from
stdin, parses each file with the standard-library ``ast`` module and writes
one JSON object per file to stdout. The analysed code is never imported or
executed.
"""
import ast
import json
import sys

HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options"}
MODEL_BASES = {"Model", "Base", "DeclarativeBase", "SQLModel", "Document", "EmbeddedDocument", "BaseModel_"}
DB_READ = ("query", "select", "get", "filter", "all", "first", "count", "find", "fetch", "exists", "scalar", "execute")
DB_WRITE = ("add", "delete", "merge", "insert", "update", "save", "create", "remove", "bulk", "commit")


def dotted(node):
    """Returns a dotted name for Name / Attribute chains, else None."""
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    if isinstance(node, ast.Call):
        inner = dotted(node.func)
        if inner:
            parts.append(inner + "()")
            return ".".join(reversed(parts))
    return None


def loc(path, node):
    return {
        "path": path,
        "startLine": getattr(node, "lineno", 1),
        "endLine": getattr(node, "end_lineno", None) or getattr(node, "lineno", 1),
        "startColumn": getattr(node, "col_offset", 0),
    }


def first_line(text):
    if not text:
        return None
    para = text.strip().split("\n\n")[0]
    para = " ".join(para.split())
    return para[:297] + "..." if len(para) > 300 else para


class Extractor:
    def __init__(self, path, source):
        self.path = path
        self.lines = source.splitlines()
        self.symbols = []
        self.imports = []
        self.references = []
        self.used = set()
        self.seen = set()

    def evidence(self, node):
        i = getattr(node, "lineno", 1) - 1
        text = self.lines[i].strip() if 0 <= i < len(self.lines) else ""
        return text[:197] + "..." if len(text) > 200 else text

    def unique(self, base):
        ident, i = base, 2
        while ident in self.used:
            ident = "%s~%d" % (base, i)
            i += 1
        self.used.add(ident)
        return ident

    def add_symbol(self, node, name, kind, parent, metadata=None, description=None):
        local = self.unique("%s.%s" % (parent, name) if parent else name)
        sym = {
            "localId": local,
            "name": name,
            "kind": kind,
            "parent": parent,
            "location": loc(self.path, node),
            "exported": not name.startswith("_"),
            "metadata": metadata or {},
        }
        if description:
            sym["description"] = description
        self.symbols.append(sym)
        return local

    def add_ref(self, kind, frm, name, node, receiver=None, metadata=None):
        key = (kind, frm, name, receiver)
        if key in self.seen:
            return
        self.seen.add(key)
        target = {"name": name}
        if receiver:
            target["receiver"] = receiver
        ref = {
            "kind": kind,
            "from": frm,
            "target": target,
            "location": loc(self.path, node),
            "evidence": self.evidence(node),
            "method": "python-ast",
            "confidence": 0,
            "verified": False,
        }
        if metadata:
            ref["metadata"] = metadata
        self.references.append(ref)

    def add_resolved(self, kind, frm, local, node, method="pattern", confidence=0.95):
        self.references.append({
            "kind": kind,
            "from": frm,
            "target": {"resolved": {"path": self.path, "localId": local}},
            "location": loc(self.path, node),
            "evidence": self.evidence(node),
            "method": method,
            "confidence": confidence,
            "verified": True,
        })

    # -- declarations -----------------------------------------------------

    def decorators(self, node):
        out = []
        for d in getattr(node, "decorator_list", []):
            target = d.func if isinstance(d, ast.Call) else d
            name = dotted(target)
            if name:
                out.append(name)
        return out

    def route_info(self, node):
        """Detects @app.get("/x"), @router.post("/x"), @app.route("/x", methods=[...])."""
        found = []
        for d in getattr(node, "decorator_list", []):
            if not isinstance(d, ast.Call) or not isinstance(d.func, ast.Attribute):
                continue
            attr = d.func.attr
            if not d.args or not isinstance(d.args[0], ast.Constant) or not isinstance(d.args[0].value, str):
                continue
            route = d.args[0].value
            if attr in HTTP_METHODS:
                found.append((attr.upper(), route, d))
            elif attr in ("route", "api_route", "websocket"):
                methods = ["WS"] if attr == "websocket" else ["GET"]
                for kw in d.keywords:
                    if kw.arg == "methods" and isinstance(kw.value, (ast.List, ast.Tuple)):
                        methods = [e.value.upper() for e in kw.value.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)] or methods
                for m in methods:
                    found.append((m, route, d))
        return found

    def visit_function(self, node, parent, in_class):
        kind = "Method" if in_class else "Function"
        args = [a.arg for a in node.args.args]
        meta = {
            "signature": "def %s(%s)" % (node.name, ", ".join(args)),
            "decorators": self.decorators(node),
        }
        if isinstance(node, ast.AsyncFunctionDef):
            meta["async"] = True
        local = self.add_symbol(node, node.name, kind, parent, meta, first_line(ast.get_docstring(node)))
        for method, route, dec in self.route_info(node):
            ep = self.unique("route:%s %s" % (method, route))
            self.symbols.append({
                "localId": ep,
                "name": "%s %s" % (method, route),
                "kind": "ApiEndpoint",
                "parent": None,
                "location": loc(self.path, dec),
                "exported": False,
                "metadata": {"httpMethod": method, "routePath": route, "framework": "decorator"},
            })
            self.add_resolved("ROUTES_TO", ep, local, dec)
        for d in node.decorator_list:
            self.visit_expr(d, local)
        for a in list(node.args.args) + list(node.args.kwonlyargs):
            if a.annotation is not None:
                self.visit_annotation(a.annotation, local)
        if node.returns is not None:
            self.visit_annotation(node.returns, local)
        for stmt in node.body:
            self.visit_body(stmt, local)
        return local

    def visit_class(self, node, parent):
        bases = [dotted(b) for b in node.bases]
        bases = [b for b in bases if b]
        has_table = any(
            isinstance(s, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "__tablename__" for t in s.targets)
            for s in node.body
        )
        is_model = has_table or any(b.split(".")[-1] in MODEL_BASES for b in bases)
        kind = "DatabaseModel" if is_model else "Class"
        meta = {"bases": bases, "decorators": self.decorators(node)}
        local = self.add_symbol(node, node.name, kind, parent, meta, first_line(ast.get_docstring(node)))
        for b in node.bases:
            name = dotted(b)
            if name:
                parts = name.split(".")
                self.add_ref("EXTENDS", local, parts[-1], b, ".".join(parts[:-1]) or None)
        for d in node.decorator_list:
            self.visit_expr(d, local)
        for stmt in node.body:
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self.visit_function(stmt, local, True)
            elif isinstance(stmt, ast.ClassDef):
                self.visit_class(stmt, local)
            else:
                self.visit_body(stmt, local)
        return local

    def visit_module(self, tree):
        for stmt in tree.body:
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self.visit_function(stmt, None, False)
            elif isinstance(stmt, ast.ClassDef):
                self.visit_class(stmt, None)
            elif isinstance(stmt, (ast.Assign, ast.AnnAssign)):
                targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]
                owner = None
                for t in targets:
                    if isinstance(t, ast.Name) and not (t.id.startswith("__") and t.id.endswith("__")):
                        kind = "Constant" if t.id.isupper() else "Variable"
                        owner = self.add_symbol(stmt, t.id, kind, None)
                value = stmt.value
                if value is not None:
                    self.visit_expr(value, owner)
                # Django: urlpatterns = [path("x/", views.handler), ...]
                if any(isinstance(t, ast.Name) and t.id == "urlpatterns" for t in targets) and isinstance(value, (ast.List, ast.Tuple)):
                    self.django_urls(value)
            else:
                self.visit_body(stmt, None)

    def django_urls(self, value):
        for e in value.elts:
            if not isinstance(e, ast.Call) or dotted(e.func) not in ("path", "re_path", "url"):
                continue
            if len(e.args) < 2 or not isinstance(e.args[0], ast.Constant) or not isinstance(e.args[0].value, str):
                continue
            route = "/" + e.args[0].value.lstrip("^/").rstrip("$")
            ep = self.unique("route:ANY %s" % route)
            self.symbols.append({
                "localId": ep,
                "name": "ANY %s" % route,
                "kind": "ApiEndpoint",
                "parent": None,
                "location": loc(self.path, e),
                "exported": False,
                "metadata": {"httpMethod": "ANY", "routePath": route, "framework": "urlpatterns"},
            })
            handler = e.args[1]
            if isinstance(handler, ast.Call) and isinstance(handler.func, ast.Attribute) and handler.func.attr == "as_view":
                handler = handler.func.value
            name = dotted(handler)
            if name and not name.endswith("()"):
                parts = name.split(".")
                self.add_ref("ROUTES_TO", ep, parts[-1], e, ".".join(parts[:-1]) or None)

    # -- bodies -----------------------------------------------------------

    def visit_body(self, stmt, owner):
        if isinstance(stmt, (ast.Import, ast.ImportFrom)):
            self.visit_import(stmt)
            return
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            # Nested definitions are attributed to the enclosing symbol.
            for inner in stmt.body:
                self.visit_body(inner, owner)
            return
        for node in ast.walk(stmt):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                self.visit_import(node)
            elif isinstance(node, ast.Call):
                self.visit_call(node, owner)
            elif isinstance(node, ast.AnnAssign) and node.annotation is not None:
                self.visit_annotation(node.annotation, owner)

    def visit_expr(self, expr, owner):
        for node in ast.walk(expr):
            if isinstance(node, ast.Call):
                self.visit_call(node, owner)

    def visit_annotation(self, ann, owner):
        for node in ast.walk(ann):
            if isinstance(node, ast.Name):
                self.add_ref("USES", owner, node.id, node, None, {"typeOnly": True})
            elif isinstance(node, ast.Attribute):
                name = dotted(node)
                if name:
                    parts = name.split(".")
                    self.add_ref("USES", owner, parts[-1], node, ".".join(parts[:-1]), {"typeOnly": True})

    def visit_call(self, node, owner):
        name = dotted(node.func)
        if not name:
            return
        parts = name.split(".")
        callee = parts[-1]
        receiver = ".".join(parts[:-1]) or None
        arg_names = []
        plain_args = []
        for a in node.args[:4]:
            target = a.func if isinstance(a, ast.Call) else a
            n = dotted(target)
            if n and not n.endswith("()"):
                arg_names.append(n)
                if not isinstance(a, ast.Call):
                    plain_args.append(n)
        meta = {}
        if arg_names:
            meta["args"] = arg_names
        if callee.startswith(DB_WRITE):
            meta["db"] = "write"
        elif callee.startswith(DB_READ):
            meta["db"] = "read"
        if callee.endswith("()"):
            return
        self.add_ref("CALLS", owner, callee, node, receiver, meta or None)
        # Names passed as arguments are potential references (callbacks, models).
        for n in plain_args:
            p = n.split(".")
            self.add_ref("USES", owner, p[-1], node, ".".join(p[:-1]) or None, {"argument": True})

    def visit_import(self, node):
        if isinstance(node, ast.Import):
            for alias in node.names:
                self.imports.append({
                    "specifier": alias.name,
                    "names": [{"imported": "*", "local": alias.asname or alias.name.split(".")[0]}],
                    "kind": "static",
                    "location": loc(self.path, node),
                    "evidence": self.evidence(node),
                    "metadata": {"alias": bool(alias.asname)},
                })
        else:
            spec = "." * (node.level or 0) + (node.module or "")
            self.imports.append({
                "specifier": spec,
                "names": [{"imported": a.name, "local": a.asname or a.name} for a in node.names],
                "kind": "static",
                "location": loc(self.path, node),
                "evidence": self.evidence(node),
            })


def analyze(path, abs_path):
    result = {"path": path, "symbols": [], "imports": [], "references": [], "errors": [], "lineCount": 0}
    try:
        with open(abs_path, "rb") as fh:
            raw = fh.read()
        source = raw.decode("utf-8", errors="replace")
    except OSError as exc:
        result["errors"].append({"path": path, "message": "File could not be read: %s" % exc, "severity": "error"})
        return result
    result["lineCount"] = source.count("\n") + 1
    try:
        tree = ast.parse(source, filename=path)
    except SyntaxError as exc:
        result["errors"].append({"path": path, "message": "Syntax error: %s" % exc.msg, "line": exc.lineno, "severity": "error"})
        return result
    except (ValueError, RecursionError) as exc:
        result["errors"].append({"path": path, "message": "Parse failed: %s" % exc, "severity": "error"})
        return result
    ex = Extractor(path, source)
    try:
        ex.visit_module(tree)
    except RecursionError:
        result["errors"].append({"path": path, "message": "File nesting too deep to analyse", "severity": "error"})
    result["symbols"] = ex.symbols
    result["imports"] = ex.imports
    result["references"] = ex.references
    return result


def main():
    files = json.load(sys.stdin)
    out = sys.stdout
    for f in files:
        out.write(json.dumps(analyze(f["path"], f["abs"])))
        out.write("\n")
        out.flush()


if __name__ == "__main__":
    main()
