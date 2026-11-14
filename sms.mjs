const testMessages = [];

export async function sendSms({to,body,code}) {
  const provider=process.env.SMS_PROVIDER || 'twilio';
  if (provider === 'mock' && process.env.NODE_ENV === 'test') {
    testMessages.push({to,body,code});
    return {id:'test-sms-' + testMessages.length};
  }
  if (provider === 'mock' && process.env.NODE_ENV === 'development' && process.env.ALLOW_DEV_OTP === '1') {
    return {id:'local-dev',devCode:code};
  }
  if (provider !== 'twilio') throw new Error('Set SMS_PROVIDER=twilio to deliver verification codes.');
  const {TWILIO_ACCOUNT_SID:sid,TWILIO_AUTH_TOKEN:token,TWILIO_FROM:from}=process.env;
  if (!sid || !token || !from) throw new Error('Phone verification needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM.');
  const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,{
    method:'POST',
    headers:{Authorization:'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({To:to,From:from,Body:body})
  });
  if (!response.ok) throw new Error('SMS delivery failed. Check the phone number and try again.');
  return response.json();
}

export function takeTestMessages(recipient) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Unavailable.');
  const matching=testMessages.filter(message => message.to === recipient);
  for (let index=testMessages.length-1;index>=0;index--) if (testMessages[index].to === recipient) testMessages.splice(index,1);
  return matching;
}
