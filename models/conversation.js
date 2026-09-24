const mongoose=require('mongoose');
const schema=new mongoose.Schema({participants:[{type:mongoose.Schema.Types.ObjectId,ref:'User'}],lastMessage:{type:String,default:''},lastMessageAt:{type:Date,default:null},unreadFor:[{type:mongoose.Schema.Types.ObjectId,ref:'User'}]},{timestamps:true});module.exports=mongoose.models.Conversation||mongoose.model('Conversation',schema);
