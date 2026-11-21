import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'order_card.dart';

void main() {
  testWidgets("shows the design's title and summary by default", (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: OrderCard())));
    expect(find.text('Order summary'), findsOneWidget);
    expect(find.text('Two items, ready to ship.'), findsOneWidget);
  });

  testWidgets('shows the order it is given', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: OrderCard(title: 'Your order', summary: 'Three items, on their way.'))));
    expect(find.text('Your order'), findsOneWidget);
    expect(find.text('Three items, on their way.'), findsOneWidget);
  });
}
