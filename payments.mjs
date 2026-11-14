import { createHmac, timingSafeEqual } from 'node:crypto';

function signature(expected, supplied) {
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const left=Buffer.from(expected,'hex'),right=Buffer.from(supplied,'hex');
  return left.length===right.length&&timingSafeEqual(left,right);
}

export function createPaymentAdapter() {
  const provider=process.env.PAYMENT_PROVIDER || '';
  if (provider==='mock') {
    if (process.env.NODE_ENV!=='test') throw new Error('The mock payment adapter is only available in tests.');
    const orders=new Map();
    const additionalTransfers=new Map();
    const subscriptions=new Map();
    return {
      mode:'test-mock',keyId:'rzp_test_neighbourlink',
      async verifyLinkedAccount(accountId){return /^acc_test_[A-Za-z0-9_-]{1,60}$/.test(accountId)?{id:accountId,status:'activated'}:null;},
      async createOrder({amount,booking,ownerAccountId,ownerAmount,depositAmount}) {
        const id='order_test_'+booking;
        orders.set(id,{amount,booking,ownerAccountId,ownerAmount,depositAmount});
        return {id,amount,currency:'INR',status:'created',transfers:[{id:'trf_rent_'+booking,account:ownerAccountId,amount:ownerAmount,currency:'INR',on_hold:true},{id:'trf_deposit_'+booking,account:ownerAccountId,amount:depositAmount,currency:'INR',on_hold:true}]};
      },
      verifyCheckout:({orderId,paymentId,checkoutSignature})=>checkoutSignature==='test-signature:'+orderId+':'+paymentId,
      verifyWebhook:(raw,provided)=>provided==='mock-signature',
      async transfers(paymentId){const booking=paymentId.replace('pay_test_','');const row=orders.get('order_test_'+booking);return [...(row?[{id:'trf_rent_'+booking,amount:row.ownerAmount,on_hold:true},{id:'trf_deposit_'+booking,amount:row.depositAmount,on_hold:true}]:[]),...(additionalTransfers.get(paymentId)||[])];},
      async createPaymentTransfer(paymentId,{booking,accountId,amount}) {
        const rows=additionalTransfers.get(paymentId)||[];
        let transfer=rows.find(row=>row.notes?.booking_id===String(booking)&&row.notes?.part==='late_fee');
        if(!transfer){transfer={id:'trf_late_fee_'+booking,amount,on_hold:false,notes:{booking_id:String(booking),part:'late_fee'}};additionalTransfers.set(paymentId,[...rows,transfer]);}
        return transfer;
      },
      async createShopSubscription({shopId,planKey,expectedAmountMinor}) {
        const id='sub_test_'+shopId.replaceAll('-','').slice(0,18);
        const subscription={id,status:'created',amount:expectedAmountMinor,short_url:'https://checkout.razorpay.com/v1/checkout.js?subscription_id='+id,notes:{shop_id:shopId,plan_key:planKey}};
        subscriptions.set(id,subscription);return subscription;
      },
      async cancelShopSubscription(subscriptionId){const subscription=subscriptions.get(subscriptionId);if(!subscription)return {id:subscriptionId,status:'cancelled'};subscription.status='cancelled';return subscription;},
      async setHold(){return {status:'processed'};},
      async fetchTransfer(transferId){const booking=Number(transferId.match(/_(\d+)$/)?.[1]),row=orders.get('order_test_'+booking);return row?{id:transferId,amount:transferId.includes('deposit')?row.depositAmount:row.ownerAmount,amount_reversed:0,on_hold:true}:null;},
      async reverseTransfer(){return {status:'reversed'};},
      async refund(){return {status:'processed'};},
      async findPayment(paymentId){const booking=Number(paymentId.replace('pay_test_',''));const order=orders.get('order_test_'+booking);return order?{id:paymentId,order_id:'order_test_'+booking,amount:order.amount,currency:'INR',status:'captured',captured:true}:null;}
    };
  }
  if (provider!=='razorpay') return null;
  const keyId=process.env.RAZORPAY_KEY_ID || '';
  const keySecret=process.env.RAZORPAY_KEY_SECRET || '';
  const webhookSecret=process.env.RAZORPAY_WEBHOOK_SECRET || '';
  const shopPlanId=process.env.RAZORPAY_SHOP_PLAN_ID || '';
  if (!keyId.startsWith('rzp_test_') || !keySecret || !webhookSecret) throw new Error('Razorpay must be configured with TEST keys and a webhook secret.');
  async function request(path,method='GET',body) {
    const response=await fetch('https://api.razorpay.com/v1'+path,{
      method,headers:{Authorization:'Basic '+Buffer.from(keyId+':'+keySecret).toString('base64'),...(body?{'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)
    });
    const data=await response.json().catch(()=>({}));
    if (!response.ok) throw Object.assign(new Error(data.error?.description || 'Razorpay request failed.'),{status:503});
    return data;
  }
  return {
    mode:'razorpay-test',keyId,
    async verifyLinkedAccount(accountId){
      if (!/^acc_[A-Za-z0-9]+$/.test(accountId)) return null;
      const account=await request('/accounts/'+encodeURIComponent(accountId));
      return account.id===accountId&&account.status==='activated'?account:null;
    },
    async createOrder({amount,booking,ownerAccountId,ownerAmount,depositAmount}) {
      return request('/orders','POST',{amount,currency:'INR',receipt:'nl-'+booking,payment_capture:1,
        notes:{booking_id:String(booking),purpose:'neighbourlink_rental'},
        transfers:[
          {account:ownerAccountId,amount:ownerAmount,currency:'INR',on_hold:true,notes:{booking_id:String(booking),part:'rental'}},
          {account:ownerAccountId,amount:depositAmount,currency:'INR',on_hold:true,notes:{booking_id:String(booking),part:'deposit'}}
        ]});
    },
    async createShopSubscription({shopId,planKey,expectedAmountMinor}) {
      if(!/^plan_[A-Za-z0-9]+$/.test(shopPlanId)) throw Object.assign(new Error('Configure a Razorpay TEST subscription plan ID before enabling paid shop plans.'),{status:503});
      const providerPlan=await request('/plans/'+encodeURIComponent(shopPlanId));
      const actualAmount=Number(providerPlan.item?.amount??providerPlan.amount),currency=providerPlan.item?.currency??providerPlan.currency;
      if(actualAmount!==expectedAmountMinor||currency!=='INR'||providerPlan.period!=='monthly'||Number(providerPlan.interval)!==1) throw Object.assign(new Error('The Razorpay TEST plan must match the configured monthly INR price. No checkout was created.'),{status:503});
      return request('/subscriptions','POST',{plan_id:shopPlanId,total_count:120,customer_notify:1,notes:{shop_id:shopId,plan_key:planKey}});
    },
    cancelShopSubscription:subscriptionId=>request('/subscriptions/'+encodeURIComponent(subscriptionId)+'/cancel','POST',{cancel_at_cycle_end:0}),
    verifyCheckout:({orderId,paymentId,checkoutSignature})=>signature(createHmac('sha256',keySecret).update(orderId+'|'+paymentId).digest('hex'),checkoutSignature),
    verifyWebhook:(raw,provided)=>signature(createHmac('sha256',webhookSecret).update(raw).digest('hex'),provided),
    findPayment:paymentId=>request('/payments/'+encodeURIComponent(paymentId)),
    async transfers(paymentId){return (await request('/payments/'+encodeURIComponent(paymentId)+'/transfers')).items || [];},
    async createPaymentTransfer(paymentId,{booking,accountId,amount}) {
      const existing=await this.transfers(paymentId);
      const transfer=existing.find(row=>row.notes?.booking_id===String(booking)&&row.notes?.part==='late_fee');
      if(transfer) return transfer;
      const result=await request('/payments/'+encodeURIComponent(paymentId)+'/transfers','POST',{transfers:[{account:accountId,amount,currency:'INR',on_hold:false,notes:{booking_id:String(booking),part:'late_fee'}}]});
      const created=result.items?.[0]||result[0];
      if(!created?.id||Number(created.amount)!==Number(amount)||created.on_hold!==false) throw Object.assign(new Error('Razorpay did not confirm the late-fee seller transfer.'),{status:503});
      return created;
    },
    fetchTransfer:transferId=>request('/transfers/'+encodeURIComponent(transferId)),
    setHold:(transferId,onHold)=>request('/transfers/'+encodeURIComponent(transferId),'PATCH',{on_hold:onHold}),
    reverseTransfer:(transferId,amount)=>request('/transfers/'+encodeURIComponent(transferId)+'/reversals','POST',amount?{amount}:{}),
    refund:(paymentId,amount)=>request('/payments/'+encodeURIComponent(paymentId)+'/refund','POST',amount?{amount}: {})
  };
}

export function verifyRazorpayWebhook(adapter,raw,provided) { return adapter?.verifyWebhook(raw,provided) || false; }
