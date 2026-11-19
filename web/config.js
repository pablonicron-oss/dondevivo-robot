/* DóndeVivo · datos de Publicá y de los destacados.
   endpoint: dirección del script de Google que recibe avisos y comprobantes.
   planes: precio en guaraníes de cada plan de destacado (null = todavía sin precio, se ofrece por WhatsApp).
   cuenta: datos para la transferencia. */
window.DV = {
  endpoint: "",
  whatsapp: "595983458755",
  planes: { 7: null, 15: null, 30: null },
  cuenta: { titular: "", banco: "", numero: "", documento: "" }
};
