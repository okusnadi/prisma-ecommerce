import { Context, getUserId } from "../../utils";
import * as _ from 'lodash';
import { OrderLineItem } from "../../generated/prisma";

interface OrderLineItemInput {
  variantId: string,
  quantity: number
}

export const cart = {
  //args: VariantId: ID!, quantity: Int!
  async addItemToCart(parent, args, ctx: Context, info) {
    const userId = getUserId(ctx);

    // Find if there's any existing lineItem. If so, update the quantity
    const orderLineItems = await ctx.db.query.orderLineItems({
      where: {
        owner: { id: userId },
        variant: { id: args.variantId },
      }
    }, '{ id quantity }');

    if (orderLineItems.length > 1) {
      throw new Error('More than one same line item found in the cart. Should not be possible');
    }

    if (orderLineItems.length === 1) {
      const orderLineItem = orderLineItems[0];

      return ctx.db.mutation.updateOrderLineItem({
        where: { id: orderLineItem.id },
        data: {
          quantity: args.mergeQuantities ? args.quantity + orderLineItem.quantity : args.quantity
        }
      }, info);
    }

    return ctx.db.mutation.createOrderLineItem({
      data: {
        owner: { connect: { id: userId } },
        quantity: args.quantity,
        variant: { connect: { id: args.variantId } }
      }
    }, info);
  },

  // args orderId: ID!, replace: Boolean!
  async addOrderToCart(parent, args, ctx: Context, info): Promise<OrderLineItem[]> {
    const userId = getUserId(ctx);

    const order = await ctx.db.query.order({ where: { id: args.orderId } }, `{
      id
      lineItems {
        id
        quantity
        variant {
          id
        }
      }
    }`);

    const currentCart = await ctx.db.query.user({ where: { id: userId } }, `{ cart { id quantity variant { id } } }`).then(user => user.cart);

    if (!order) {
      throw new Error('Order not found');
    }

    // Delete all items from cart that are not in the order
    if (args.replace) {
      const cartLineItemsToDelete = _.differenceBy(currentCart, order.lineItems, (lineItem) => lineItem.variant.id);

      await Promise.all(
        cartLineItemsToDelete.map(lineItem => ctx.db.mutation.deleteOrderLineItem({ where: { id: lineItem.id } }))
      );
    }

    return await Promise.all(
      order.lineItems.map(orderLineItem => {
        const cartOrderLineItem = currentCart.find(cartLineItem => cartLineItem.variant.id === orderLineItem.variant.id);

        if (cartOrderLineItem) {
          return ctx.db.mutation.updateOrderLineItem({
            where: { id: cartOrderLineItem.id },
            data: {
              quantity: args.replace
                ? orderLineItem.quantity
                : orderLineItem.quantity + cartOrderLineItem.quantity
            }
          }, info);
        }

        return ctx.db.mutation.createOrderLineItem({
          data: {
            owner: { connect: { id: userId } },
            quantity: orderLineItem.quantity,
            variant: { connect: { id: orderLineItem.variant.id } }
          }
        }, info);
      })
    )
  },

  async removeItemFromCart(parent, args, ctx: Context, info): Promise<OrderLineItem> {
    const userId = getUserId(ctx);

    if (!ctx.db.exists.User({ id: userId, cart_some: { id: args.lineItemId } })) {
      throw new Error('You\'re not owner of this cart.');
    }

    return ctx.db.mutation.deleteOrderLineItem({
      where: { id: args.lineItemId }
    }, info);
  },

  async updateItemFromCart(parent, args, ctx: Context, info): Promise<OrderLineItem> {
    const userId = getUserId(ctx);

    if (!ctx.db.exists.User({ id: userId, cart_some: { id: args.lineItemId } })) {
      throw new Error('You\'re not owner of this cart.');
    }

    return ctx.db.mutation.updateOrderLineItem({
      where: { id: args.lineItemId },
      data: {
        variant: {
          connect: { id: args.variantId },
        },
        quantity: args.quantity
      }
    }, info);
  }
};
