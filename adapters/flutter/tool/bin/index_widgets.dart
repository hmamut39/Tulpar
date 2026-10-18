// Tulpar's Flutter index: the widgets a library exports, with their constructor parameters, read with
// the Dart analyzer (resolved types, defaults and requiredness as the compiler sees them).
//
//   dart run bin/index_widgets.dart <projectDir> <library uri, e.g. package:flutter/material.dart>
//
// Prints JSON: { "library": ..., "widgets": [{ "name", "doc", "deprecated", "params": [...] }] }.
import 'dart:convert';
import 'dart:io';

import 'package:analyzer/dart/analysis/analysis_context_collection.dart';
import 'package:analyzer/dart/analysis/results.dart';
import 'package:analyzer/dart/element/element.dart';

Future<void> main(List<String> args) async {
  if (args.length != 2) {
    stderr.writeln('usage: index_widgets.dart <projectDir> <library uri>');
    exit(2);
  }
  // The analyzer wants an absolute, normalized path (no '..').
  final project = Directory(args[0]).absolute.uri.normalizePath().toFilePath().replaceFirst(RegExp(r'[\\/]+$'), '');
  final libraryUri = args[1];
  final collection = AnalysisContextCollection(includedPaths: [project]);
  final context = collection.contextFor(project);
  final result = await context.currentSession.getLibraryByUri(libraryUri);
  if (result is! LibraryElementResult) {
    stderr.writeln('cannot resolve $libraryUri from $project ($result)');
    exit(1);
  }

  final widgets = <Map<String, Object?>>[];
  final names = result.element.exportNamespace.definedNames2;
  for (final name in names.keys.toList()..sort()) {
    final element = names[name];
    if (element is! ClassElement || element.isPrivate || element.isAbstract) continue;
    if (!element.allSupertypes.any((t) => t.element.name == 'Widget' && t.element.library.uri.toString() == 'package:flutter/src/widgets/framework.dart')) continue;
    // The constructor a developer writes first: the unnamed one, else the first public one.
    final constructors = <ConstructorElement>[...element.constructors.where((c) => !c.isPrivate)];
    if (constructors.isEmpty) continue;
    final constructor = constructors.firstWhere((c) => c.name == null || c.name == 'new', orElse: () => constructors.first);
    widgets.add({
      'name': name,
      if (constructor.name != null && constructor.name != 'new') 'constructorName': constructor.name,
      'doc': summary(element.documentationComment),
      if (element.metadata.hasDeprecated) 'deprecated': true,
      'params': [
        for (final p in constructor.formalParameters)
          if (p.name != null && p.name != 'key')
            {
              'name': p.name,
              'type': p.type.getDisplayString(),
              'named': p.isNamed,
              'required': p.isRequiredNamed || p.isRequiredPositional,
              if (p.defaultValueCode != null) 'default': p.defaultValueCode,
            },
      ],
    });
  }
  stdout.write(jsonEncode({'library': libraryUri, 'widgets': widgets}));
}

/// The first sentence of a doc comment, without the slashes.
String? summary(String? doc) {
  if (doc == null) return null;
  final text = doc.split('\n').map((l) => l.replaceFirst(RegExp(r'^\s*///\s?'), '')).takeWhile((l) => l.trim().isNotEmpty).join(' ');
  final end = text.indexOf('. ');
  return (end < 0 ? text : text.substring(0, end + 1)).trim();
}
