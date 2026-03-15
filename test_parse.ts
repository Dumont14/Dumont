import { parseNotams } from './src/lib/notam/index.js';

const proxyResponse = {
  notamList: [
    {
      id: 'B0283/26',
      text: 'Q) SBRE/QFALC/IV/NBO/A/000/999/0504S04249W005\nAD CLSD DEVIDO SER MAINT\nORIGEM: SDIA 40C12572\n 09/02/26 08:00 a 20/03/26 14:00 UTC\n FEB 09-20 0800-1400, FEB 23-27 MAR 02-06 09-13 16-20 0930-1400',
      from: '09/02/26 08:00',
      to: '20/03/26 14:00',
      q: 'SBRE/QFALC/IV/NBO/A/000/999/0504S04249W005'
    }
  ],
  raw: '<raw html...>'
};

const result = parseNotams(proxyResponse);
console.log(JSON.stringify(result, null, 2));
