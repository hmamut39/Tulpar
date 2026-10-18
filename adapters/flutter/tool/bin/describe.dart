// Tulpar's Flutter static scan: what a widget file writes, read with the resolved Dart analyzer.
//
//   dart run bin/describe.dart <projectDir> <file.dart> [spacingClass]
//
// Prints JSON:
//   written   Figma id → the widget class each Semantics(identifier: '<id>') wraps
//   widgets   every widget class the file creates
//   literals  hard-coded colours, type and spacing ({ property, written, at })
//   tokens    values taken from the theme or the spacing constants ({ property, written, token, at })
//   errors    compile errors, so a file that cannot build says why
import 'dart:convert';
import 'dart:io';

import 'package:analyzer/dart/analysis/analysis_context_collection.dart';
import 'package:analyzer/dart/analysis/results.dart';
import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/visitor.dart';
import 'package:analyzer/dart/element/element.dart';
import 'package:analyzer/dart/element/type.dart';
import 'package:analyzer/diagnostic/diagnostic.dart';

Future<void> main(List<String> args) async {
  if (args.length < 2) {
    stderr.writeln('usage: describe.dart <projectDir> <file.dart> [spacingClass]');
    exit(2);
  }
  String normal(String p) => File(p).absolute.uri.normalizePath().toFilePath().replaceFirst(RegExp(r'[\\/]+$'), '');
  final project = normal(args[0]);
  final file = normal(args[1]);
  final spacingClass = args.length > 2 ? args[2] : null;
  final collection = AnalysisContextCollection(includedPaths: [project]);
  final unit = await collection.contextFor(file).currentSession.getResolvedUnit(file);
  if (unit is! ResolvedUnitResult) {
    stderr.writeln('cannot resolve $file ($unit)');
    exit(1);
  }
  final scan = Scan(unit, file.split(RegExp(r'[\\/]')).last, spacingClass);
  unit.unit.accept(scan);
  stdout.write(jsonEncode({
    'written': scan.written,
    'widgets': scan.widgets.toList()..sort(),
    'literals': scan.literals,
    'tokens': scan.tokens,
    'errors': [
      for (final d in unit.diagnostics)
        if (d.severity == Severity.error) '${scan.name}:${unit.lineInfo.getLocation(d.offset).lineNumber}: ${d.message}',
    ],
  }));
}

class Scan extends RecursiveAstVisitor<void> {
  Scan(this.unit, this.name, this.spacingClass);

  final ResolvedUnitResult unit;
  final String name;
  final String? spacingClass;
  final written = <String, String>{};
  final widgets = <String>{};
  final literals = <Map<String, String>>[];
  final tokens = <Map<String, String>>[];

  String at(AstNode n) => '$name:${unit.lineInfo.getLocation(n.offset).lineNumber}';

  void literal(String property, AstNode n) => literals.add({'property': property, 'written': n.toSource(), 'at': at(n)});
  void token(String property, AstNode n, String token) => tokens.add({'property': property, 'written': n.toSource(), 'token': token, 'at': at(n)});

  @override
  void visitInstanceCreationExpression(InstanceCreationExpression node) {
    final type = node.staticType;
    final cls = type is InterfaceType ? type.element : null;
    final className = cls?.name;
    if (cls != null && className != null && isWidget(cls)) widgets.add(className);
    final named = {
      for (final a in node.argumentList.arguments)
        if (a is NamedArgument) a.name.lexeme: a.argumentExpression,
    };
    final positional = [for (final a in node.argumentList.arguments) if (a is! NamedArgument) a.argumentExpression];

    if (className == 'Semantics') {
      final id = named['identifier'];
      final child = named['child'];
      if (id is SimpleStringLiteral && child != null) {
        final wrapped = child.staticType is InterfaceType ? (child.staticType as InterfaceType).element.name : null;
        if (wrapped != null) written[id.value] = wrapped;
      }
    }
    if (className == 'Color' && fromLibrary(cls, 'dart:ui')) literal(colorRole(node), node);
    if (className == 'TextStyle') {
      for (final e in named.entries) {
        final property = const {'fontSize': 'fontSize', 'fontWeight': 'fontWeight', 'height': 'lineHeight', 'letterSpacing': 'letterSpacing', 'fontFamily': 'fontFamily'}[e.key];
        if (property != null && isConstant(e.value)) literal(property, e.value);
      }
    }
    if (className == 'EdgeInsets' || className == 'EdgeInsetsDirectional') {
      for (final a in [...positional, ...named.values]) {
        if (isNonZeroNumber(a)) literal('padding', a);
      }
    }
    if (className == 'SizedBox') {
      for (final key in ['width', 'height']) {
        final v = named[key];
        if (v != null && isNonZeroNumber(v)) literal('gap', v);
      }
    }
    if ((className == 'BorderRadius' || className == 'Radius') && node.constructorName.name?.name == 'circular') {
      if (positional.isNotEmpty && isNonZeroNumber(positional.first)) literal('radius', positional.first);
    }
    super.visitInstanceCreationExpression(node);
  }

  @override
  void visitMethodInvocation(MethodInvocation node) {
    // BorderRadius.circular(6) and EdgeInsets.all(8) parse as invocations when not const.
    final target = node.target;
    final targetName = target is SimpleIdentifier ? target.name : null;
    final args = [for (final a in node.argumentList.arguments) a.argumentExpression];
    if ((targetName == 'BorderRadius' || targetName == 'Radius') && node.methodName.name == 'circular' && args.isNotEmpty && isNonZeroNumber(args.first)) {
      literal('radius', args.first);
    }
    super.visitMethodInvocation(node);
  }

  @override
  void visitPrefixedIdentifier(PrefixedIdentifier node) {
    checkReference(node, node.prefix.staticType, node.identifier);
    super.visitPrefixedIdentifier(node);
  }

  @override
  void visitPropertyAccess(PropertyAccess node) {
    checkReference(node, node.realTarget.staticType, node.propertyName);
    super.visitPropertyAccess(node);
  }

  void checkReference(Expression node, DartType? targetType, SimpleIdentifier property) {
    final element = property.element;
    final owner = element?.enclosingElement;
    final ownerName = owner is InterfaceElement ? owner.name : null;
    // Colors.red, Colors.blue.shade700: Material's fixed palette, not the theme.
    if (ownerName == 'Colors' && fromLibrary(owner, 'package:flutter/src/material/colors.dart')) {
      if (property.name == 'transparent') return;
      if (node.parent is! PropertyAccess && node.parent is! PrefixedIdentifier) literal(colorRole(node), node);
      return;
    }
    if (targetType is InterfaceType) {
      final typeName = targetType.element.name;
      if (typeName == 'ColorScheme') token(colorRole(node), node, 'colorScheme.${property.name}');
      if (typeName == 'TextTheme') token('fontSize', node, 'textTheme.${property.name}');
    }
    if (spacingClass != null && ownerName == spacingClass) token('gap', node, '$spacingClass.${property.name}');
  }

  /// Which colour a value is: text (inside a TextStyle), stroke (a BorderSide), else a fill.
  String colorRole(AstNode n) {
    for (AstNode? p = n.parent; p != null; p = p.parent) {
      if (p is InstanceCreationExpression) {
        final name = (p.staticType as InterfaceType?)?.element.name;
        if (name == 'TextStyle') return 'textColor';
        if (name == 'BorderSide' || name == 'Border') return 'strokeColor';
        return 'fill';
      }
    }
    return 'fill';
  }
}

bool isWidget(InterfaceElement cls) => cls.allSupertypes.any((t) => t.element.name == 'Widget' && fromLibrary(t.element, 'package:flutter/src/widgets/framework.dart'));

bool fromLibrary(Element? e, String uri) => e?.library?.uri.toString() == uri;

bool isConstant(Expression e) => e is IntegerLiteral || e is DoubleLiteral || e is SimpleStringLiteral || (e is PrefixedIdentifier && e.prefix.name == 'FontWeight');

bool isNonZeroNumber(AstNode e) => (e is IntegerLiteral && e.value != 0) || (e is DoubleLiteral && e.value != 0);
