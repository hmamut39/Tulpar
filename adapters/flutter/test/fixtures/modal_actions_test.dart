import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'modal_actions.dart';

void main() {
  testWidgets('shows both actions as Material buttons', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: ModalActions())));
    expect(find.byType(OutlinedButton), findsOneWidget);
    expect(find.byType(FilledButton), findsOneWidget);
    expect(find.text('Button'), findsNWidgets(2));
  });

  testWidgets('fails honestly', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: ModalActions())));
    expect(find.text('Delete'), findsOneWidget);
  });
}
