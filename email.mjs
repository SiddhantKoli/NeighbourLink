const testMessages = [];

export async function sendEmail({to,subject,text,html}) {
  const provider = process.env.EMAIL_PROVIDER || 'resend';
  if (provider === 'mock' && process.env.NODE_ENV === 'test') {
    testMessages.push({to,subject,text,html});
    return {id:'test-' + testMessages.length};
  }
  if (provider !== 'resend') throw new Error('Set EMAIL_PROVIDER=resend and configure email delivery before enabling account email flows.');
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new Error('Account email delivery is not configured yet. Set RESEND_API_KEY and EMAIL_FROM.');
  const response = await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{Authorization:'Bearer ' + process.env.RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({from:process.env.EMAIL_FROM,to:[to],subject,text,html})
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error('Email delivery failed' + (result.name ? ' (' + result.name + ')' : '') + '. Try again later.');
  }
  return response.json();
}

export function takeTestMessages(recipient) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Unavailable.');
  const matching = testMessages.filter(message => message.to === recipient);
  for (let index=testMessages.length-1; index>=0; index--) if (testMessages[index].to === recipient) testMessages.splice(index,1);
  return matching;
}
