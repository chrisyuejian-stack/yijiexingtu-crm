"use strict";
const secret=document.querySelector('#secret');
document.querySelector('#generate').addEventListener('click',()=>{secret.value=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));});
document.querySelector('#select').addEventListener('click',()=>{secret.focus();secret.select();});
