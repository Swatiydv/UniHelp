const mongoose=require('mongoose');
const schema=new mongoose.Schema({conversation:{type:mongoose.Schema.Types.ObjectId,ref:'Conversation'},sender:{type:mongoose.Schema.Types.ObjectId,ref:'User'},text:{type:String,trim:true,maxlength:2000}},{timestamps:true});module.exports=mongoose.models.Message||mongoose.model('Message',schema);
