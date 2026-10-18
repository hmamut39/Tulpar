// The numeric constants a class declares (a team's spacing scale, e.g. Space.md = 12), read with the
// analyzer, for Tulpar's tokens.
//
//   dart run bin/constants.dart <projectDir> <file.dart> <ClassName>
//
// Prints JSON: { "<name>": <value>, ... }
import 'dart:convert';
import 'dart:io';

import 'package:analyzer/dart/analysis/analysis_context_collection.dart';
import 'package:analyzer/dart/analysis/results.dart';
import 'package:analyzer/dart/element/element.dart';

Future<void> main(List<String> args) async {
  if (args.length != 3) {
    stderr.writeln('usage: constants.dart <projectDir> <file.dart> <ClassName>');
    exit(2);
  }
  String normal(String p) => File(p).absolute.uri.normalizePath().toFilePath().replaceFirst(RegExp(r'[\/]+$'), '');
  final file = normal(args[1]);
  final collection = AnalysisContextCollection(includedPaths: [normal(args[0])]);
  final result = await collection.contextFor(file).currentSession.getResolvedLibrary(file);
  if (result is! ResolvedLibraryResult) {
    stderr.writeln('cannot resolve $file ($result)');
    exit(1);
  }
  final cls = result.element.classes.where((c) => c.name == args[2]).firstOrNull;
  if (cls == null) {
    stderr.writeln('no class ${args[2]} in $file');
    exit(1);
  }
  final values = <String, num>{};
  for (final f in cls.fields) {
    if (!f.isStatic || !f.isConst || f.name == null) continue;
    final v = f.computeConstantValue();
    final n = v?.toDoubleValue() ?? v?.toIntValue();
    if (n != null) values[f.name!] = n;
  }
  stdout.write(jsonEncode(values));
}
