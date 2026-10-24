// The rule of a customer: how much an order costs. It is a module for WebAssembly, so it is built with
//
//	GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o ../plugins/rules.wasm
package main

import (
	totalfusion "github.com/totaljs-es/totalfusion/go"
)

// A module of this kind does not run main: its functions are registered when it starts.
func init() {

	app := totalfusion.New()

	app.Function("discount.apply", func(call *totalfusion.Call) (any, error) {

		price, okPrice := call.Args.Get("price").AsFloat()
		quantity, okQuantity := call.Args.Get("quantity").AsFloat()

		if !okPrice || !okQuantity || price < 0 || quantity < 1 {
			return nil, totalfusion.Invalid("price and quantity must be numbers, and the quantity at least 1")
		}

		// 10% from 10 units, 20% from 50, and 5% more for a premium customer
		discount := 0.0

		if quantity >= 50 {
			discount = 0.20
		} else if quantity >= 10 {
			discount = 0.10
		}

		if tier, _ := call.Args.Get("tier").AsString(); tier == "premium" {
			discount += 0.05
		}

		subtotal := price * quantity

		return map[string]any{
			"subtotal": subtotal,
			"discount": discount,
			"total":    subtotal * (1 - discount),
		}, nil

	}).Summary("The price of an order, with the discount of this customer").Input("*price:Number\n*quantity:Number\ntier:String").Output("subtotal:Number\ndiscount:Number\ntotal:Number")

	app.Wasm()
}

func main() {}
