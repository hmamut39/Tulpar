import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'order_card.dart';

void main() {
  testWidgets('shows the title and the summary', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: OrderCard())));
    expect(find.text('Order summary'), findsOneWidget);
    expect(find.text('Two items, ready to ship.'), findsOneWidget);
  });
}
